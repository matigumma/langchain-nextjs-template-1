import { OpenAI } from "langchain/llms/openai";
import { SqlDatabase } from "langchain/sql_db";
import { createSqlAgent, SqlToolkit } from "langchain/agents/toolkits/sql";
import { DataSource } from "typeorm";
import { NextRequest, NextResponse } from "next/server";

/** This example uses Chinook database, which is a sample database available for SQL Server, Oracle, MySQL, etc.
 * To set it up follow the instructions on https://database.guide/2-sample-databases-sqlite/, placing the .db file
 * in the examples folder.
 */
export async function POST(req: NextRequest) {
    try {
        const datasource = new DataSource({
            type: "mssql",
            host: process.env.DB_HOST,
            port: 1433,
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASS,
            database: process.env.DB,
            options: {
                encrypt: false, // Encrypt the connection
                trustServerCertificate: true, // Accept self-signed certificates
            }
        });
        const db = await SqlDatabase.fromDataSourceParams({
            appDataSource: datasource,
        });
        const model = new OpenAI({ modelName: "gpt-3.5-turbo-0613", temperature: 0 });
        const toolkit = new SqlToolkit(db, model);
        const executor = createSqlAgent(model, toolkit);

        const input = `List all M0_CuentasCorrientesWeb with IDprofiles = 9`;

        console.log(`Executing with input "${input}"...`);

        const result = await executor.call({ input });

        console.log(`Got output ${result.output}`);

        console.log(
            `Got intermediate steps ${JSON.stringify(
            result.intermediateSteps,
            null,
            2
            )}`
        );

        await datasource.destroy();

        return NextResponse.json(
            { output: result.output, intermediate_steps: result.intermediateSteps },
            { status: 200 },
        );
    } catch (e: any) {
        console.log(`Got output ERROR ${e.message}`);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}