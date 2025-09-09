import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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
export async function startHttpSse(port = Number(process.env.PORT || 3000)) {
    const app = express();
    app.use(cors());
    app.use(express.json());
    // Basic request logger
    app.use((req, _res, next) => {
        console.log(`[http] ${new Date().toISOString()} ${req.method} ${req.url}`);
        next();
    });
    const transports = {};
    app.get('/mcp', async (req, res) => {
        console.log('[sse] GET /mcp – establishing SSE stream');
        const transport = new SSEServerTransport('/messages', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;
        console.log(`[sse] session created: ${sessionId}. Active sessions: ${Object.keys(transports).length}`);
        transport.onclose = () => {
            delete transports[sessionId];
            console.log(`[sse] session closed: ${sessionId}. Active sessions: ${Object.keys(transports).length}`);
        };
        const server = createMcpServer();
        await server.connect(transport);
        console.log(`[sse] server connected for session: ${sessionId}`);
    });
    app.post('/messages', async (req, res) => {
        const sessionId = req.query.sessionId;
        console.log(`[sse] POST /messages – sessionId=${sessionId}`);
        if (!sessionId) {
            console.warn('[sse] POST /messages missing sessionId');
            res.status(400).send('Missing sessionId parameter');
            return;
        }
        const transport = transports[sessionId];
        if (!transport) {
            console.warn(`[sse] POST /messages session not found: ${sessionId}. Active: ${Object.keys(transports).join(',')}`);
            res.status(404).send('Session not found');
            return;
        }
        await transport.handlePostMessage(req, res, req.body);
        console.log(`[sse] POST /messages handled for session: ${sessionId}`);
    });
    await new Promise((resolve, reject) => {
        app.listen(port, (err) => {
            if (err)
                return reject(err);
            console.log(`MCP HTTP+SSE server listening on http://localhost:${port}`);
            resolve();
        });
    });
}
// CLI: choose mode via env or args
if (process.argv.includes('--stdio')) {
    void startStdio();
}
else if (process.argv.includes('--http')) {
    void startHttpSse();
}
