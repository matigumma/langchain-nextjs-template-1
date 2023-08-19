import { Message as VercelChatMessage } from "ai";
import { SqlDatabase } from "langchain/sql_db";
import { createSqlAgent, SqlToolkit } from "langchain/agents/toolkits/sql";
import { DataSource } from "typeorm";
import { NextRequest, NextResponse } from "next/server";
import { AIMessage, ChatMessage, HumanMessage } from "langchain/schema";
import { BufferMemory, ChatMessageHistory } from "langchain/memory";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { Calculator } from "langchain/tools/calculator";
import { ChatOpenAI } from "langchain/chat_models/openai";

// https://github.com/Syed007Hassan/Langchain/blob/7be192c55b1446dad64dbb76f39834e420cacc9d/SQL-AGENTS/index2.js

const SQL_PREFIX = `You are an agent designed to interact with a SQL database.
You can order the results by a relevant column to return the most interesting examples in the database.
Never query for all the columns from a specific table, only ask for a the few relevant columns given the question.
If you get a "no such table" error, rewrite your query by using the table in quotes.
DO NOT use a column name that does not exist in the table.
as context for table M6_Pedidos have this column names ["ID", "IDFletes", "IDCuentasCorrientes", "IDSubCuentasCorrientes", "IDCtasCtesLugaresDeRecepcion", "IDCampanias", "IDComprobantes", "IDModalidades", "IDCtaCteProveedor", "IDFormularios", "IDUnidadesDeNegocio", "IDMonedas", "IDExpresadoEn", "IDComisionistas", "Cotizacion", "Comision", "NroInterno", "Sucursal", "Numero", "Fecha", "FechaDeAlta", "FechaVencimiento", "FechaCondiciones", "TipoVenta", "Propio", "LugarDeRecepcion", "Condiciones", "Comentario", "IDTiposDePedidos", "IDCondicionesDeFlete", "Status", "Usuario", "IDCobradores", "ComisionCobrador", "IDCondicionesComerciales", "Activa", "IDListaPrecios"];
as context for table M6_PedidosCuerpo have this column names ["ID", "IDPedidos", "IDItems", "IDDestinos", "IDDepositos", "Descripcion", "Cantidad", "Precio", "Tipo", "PrecioReferencial", "CantidadAutorizada", "Activa"]
You have access to tools for interacting with the database.
Only use the below tools. Only use the information returned by the below tools to construct your final answer.
You MUST double check your query before executing it. If you get an QueryFailedError while executing a query, rewrite a different query and try again.
DO NOT try to execute the query more than three times.
DO NOT make any DML statements (INSERT, UPDATE, DELETE, DROP etc.) to the database.
If the question does not seem related to the database, just return "I don't know" as the answer.
If you cannot find a way to answer the question, just return the best answer you can find after trying at least three times.`;


const SQL_SUFFIX = `Begin!
Question: {input}
Thought: I should look at the tables in the database to see what I can query.
{agent_scratchpad}`;

const convertVercelMessageToLangChainMessage = (message: VercelChatMessage) => {
    if (message.role === "user") {
      return new HumanMessage(message.content);
    } else if (message.role === "assistant") {
      return new AIMessage(message.content);
    } else {
      return new ChatMessage(message.content, message.role);
    }
  };

  
export async function POST(req: NextRequest) {
    const body = await req.json();

    const messages = (body.messages ?? []).filter(
      (message: VercelChatMessage) =>
        message.role === "user" || message.role === "assistant",
    );
    const returnIntermediateSteps = body.show_intermediate_steps;
    const previousMessages = messages
      .slice(0, -1)
      .map(convertVercelMessageToLangChainMessage);
    const currentMessageContent = messages[messages.length - 1].content;

    try {
        const datasource = new DataSource({
            type: "mssql",
            host: process.env.DB_HOST,
            port: 1433,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASS,
            database: process.env.DB,
            schema: "dbo",
            options: {
                readOnlyIntent: true,
                encrypt: false, // Encrypt the connection
                trustServerCertificate: true, // Accept self-signed certificates
            }
        });
        const db = await SqlDatabase.fromDataSourceParams({
            appDataSource: datasource,
        });

        // LLM
        const model = new ChatOpenAI({ modelName: "gpt-3.5-turbo-0613", temperature: 0 });
        
        // tools
        const toolkit = new SqlToolkit(db, model);
        const { tools: sqtools } = toolkit;
        const tools = [new Calculator(), ...sqtools];
        
        // const executor = createSqlAgent(model, toolkit, {
        //     topK: 10,
        //     prefix: SQL_PREFIX,
        //     suffix: SQL_SUFFIX,
        //   });

        const executor = await initializeAgentExecutorWithOptions(tools, model, {
            maxIterations: 3,
            agentType: "openai-functions",
            verbose: true,
            returnIntermediateSteps,
            memory: new BufferMemory({
              memoryKey: "chat_history",
              chatHistory: new ChatMessageHistory(previousMessages),
              returnMessages: true,
              outputKey: "output",
            }),agentArgs: {
                prefix: SQL_PREFIX,
            }
          });

        // const input = `How many rows are in the M0_CuentasCorrientesWeb table`;

        console.log(`Executing with input "${currentMessageContent}"...`);

        const result = await executor.call({ input: currentMessageContent });

        // console.log(`Got output ${result.output}`);

        // console.log(
        //     `Got intermediate steps ${JSON.stringify(
        //     result.intermediateSteps,
        //     null,
        //     2
        //     )}`
        // );

        await datasource.destroy();

        return NextResponse.json(
            { output: result.output, intermediate_steps: result.intermediateSteps },
            { status: 200 },
        );
    } catch (e: any) {
        console.log(`Got output ERROR ${e}`);
        // return NextResponse.json(
        //     { output: e.message, intermediate_steps: [] },
        //     { status: 200 },
        // );
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}