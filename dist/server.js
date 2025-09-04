import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// Create MCP server with exec tool
export function createMcpServer() {
    const mcpServer = new McpServer({
        name: 'maas-mcpserver-linux-cmd-line',
        version: '1.0.0',
    }, { capabilities: { logging: {} } });
    const execInput = {
        command: z.string().describe('A full shell command line to execute'),
        cwd: z.string().optional().describe('Working directory'),
        env: z.record(z.string()).optional().describe('Environment variables as key/value pairs'),
    };
    const execOutput = {
        exitCode: z.number().describe('Process exit code'),
        stdout: z.string().describe('Captured standard output'),
        stderr: z.string().describe('Captured standard error'),
    };
    mcpServer.registerTool('exec', {
        title: 'Execute Linux command',
        description: 'Executes a Linux command on the host system with unlimited access',
        inputSchema: execInput,
        outputSchema: execOutput,
    }, async (args, extra) => {
        const { command, cwd, env } = args;
        const child = spawn(command, { shell: true, cwd, env: { ...process.env, ...env } });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
            const chunk = d.toString();
            stdout += chunk;
            void mcpServer.sendLoggingMessage({ level: 'info', data: chunk }, extra.sessionId);
        });
        child.stderr.on('data', (d) => {
            const chunk = d.toString();
            stderr += chunk;
            void mcpServer.sendLoggingMessage({ level: 'error', data: chunk }, extra.sessionId);
        });
        const exitCode = await new Promise((resolve) => {
            child.on('close', (code) => resolve(code ?? 0));
        });
        return {
            content: [],
            structuredContent: {
                exitCode,
                stdout,
                stderr,
            },
        };
    });
    return mcpServer;
}
// stdio entrypoint for MCP
export async function startStdio() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
// HTTP SSE server (deprecated protocol, but useful for external clients)
export async function startHttp(port = Number(process.env.PORT || 3000)) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    // Basic request logger
    app.use((req, _res, next) => {
        console.log(`[http] ${new Date().toISOString()} ${req.method} ${req.url}`);
        next();
    });
    // Streamable HTTP transport (stateful, with JSON responses only)
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (sid) => console.log(`[http] session initialized: ${sid}`),
        onsessionclosed: (sid) => console.log(`[http] session closed: ${sid}`),
    });
    await server.connect(transport);
    // Single endpoint for both init and tool calls
    app.all('/mcp', async (req, res) => {
        await transport.handleRequest(req, res, req.body);
    });
    await new Promise((resolve, reject) => {
        app.listen(port, (err) => {
            if (err)
                return reject(err);
            console.log(`MCP Streamable HTTP server listening on http://localhost:${port}`);
            resolve();
        });
    });
}
// CLI: choose mode via env or args
if (process.argv.includes('--stdio')) {
    void startStdio();
}
else if (process.argv.includes('--http')) {
    void startHttp();
}
