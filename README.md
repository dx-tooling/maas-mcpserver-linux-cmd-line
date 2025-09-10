# MCP Server: Linux Command-Line Executor

A Node.js/NPM-based MCP server that:

- Exposes an HTTP SSE endpoint for MCP clients
- Provides an `exec` tool that runs arbitrary Linux command lines on the host

Security note: Intended to run inside a Docker container with trusted clients. The `exec` tool provides unrestricted command execution.

## Requirements

- nvm and a Node version that matches `.nvmrc`
- npm

## Setup

```bash
cd /Users/manuel/git/github/dx-tooling/maas/maas-mcpserver-linux-cmd-line
nvm use
npm install
```

## Running in SSE mode (HTTP)

- Dev (TypeScript):

```bash
nvm use
PORT=3000 npm run dev:http
```

- Build + Run (JavaScript):

```bash
nvm use
npm run build
PORT=3000 npm run start:http
```

The server exposes:

- GET `/health` → Health check endpoint (returns HTTP 200 with service status)
- GET `/mcp` → Establishes SSE stream (deprecated HTTP+SSE transport)
- POST `/messages?sessionId=<id>` → JSON-RPC messages from the client

Use an MCP-compatible client to connect via SSE. Manual interaction is non-trivial because the `sessionId` is provided over the SSE stream.

## Health Check

The server provides a health check endpoint at `/health` that returns HTTP 200 when the service is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-10T06:50:40.772Z",
  "service": "maas-mcpserver-linux-cmd-line",
  "version": "1.0.0",
  "activeSessions": 0
}
```

## Running in stdio mode

- Dev:

```bash
nvm use
npm run dev:stdio
```

- Build + Run:

```bash
nvm use
npm run build
npm run start:stdio
```

## Tool: `exec`

- Name: `exec`
- Description: Execute a Linux command on the host system
- Input schema:
  - `command` (string, required): Full shell command line
  - `cwd` (string, optional): Working directory
  - `env` (record<string,string>, optional): Extra environment variables
- Output schema (structured):
  - `exitCode` (number)
  - `stdout` (string)
  - `stderr` (string)

While the command runs, stdout/stderr chunks are forwarded as MCP logging messages over the current session.

## Quality

```bash
nvm use
npm run quality
```

## Notes

- Default port is `3000` when `PORT` is not set.
- SSE transport in this project is provided for compatibility/testing (deprecated protocol). For production, prefer stdio or modern transports with compatible clients.
