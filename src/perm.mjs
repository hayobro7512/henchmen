// Stdio MCP server Claude Code calls when an agent needs permission. It holds the call open until the human decides on the page.
import http from 'node:http';
import readline from 'node:readline';

const { HENCHMEN_PORT: port, HENCHMEN_RUN: runId, HENCHMEN_SECRET: secret } = process.env;
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function ask(tool, input) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/approval', method: 'POST', headers: { 'x-henchmen': '1', 'content-type': 'application/json', host: `localhost:${port}` } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        try { resolve(JSON.parse(text).decision); } catch { resolve('deny'); }
      });
    });
    req.on('error', () => resolve('deny'));
    req.end(JSON.stringify({ run: runId, secret, tool, input }));
  });
}

for await (const l of readline.createInterface({ input: process.stdin })) {
  let m;
  try { m = JSON.parse(l); } catch { continue; }
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'henchmen', version: '1' } } });
  } else if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'approve', description: 'Ask the human on the Henchmen page to approve a tool call.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } });
  } else if (m.method === 'tools/call') {
    const a = m.params.arguments || {};
    // Answered without blocking the loop, so a waiting approval never stalls the MCP handshake.
    ask(a.tool_name, a.input).then((d) => {
      const r = d === 'allow' ? { behavior: 'allow', updatedInput: a.input } : { behavior: 'deny', message: 'The human denied this on the page. Carry on with other work.' };
      send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r) }] } });
    });
  } else if (m.id !== undefined) {
    send({ jsonrpc: '2.0', id: m.id, result: {} });
  }
}
