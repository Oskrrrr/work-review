import { createServer } from 'node:http';

// Bind the port before loading the CloudBase SDK so the HTTP gateway sees a
// ready process during cold start.
let startupError;
const handlerPromise = import('./index.mjs').catch(error => {
  startupError = error;
  console.error('worklog-api startup failed', error);
  return null;
});
const port = Number(process.env.PORT || 9000);

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const parsed = new URL(request.url || '/', 'http://127.0.0.1');
    const handler = await handlerPromise;
    if (!handler) throw startupError || new Error('业务模块加载失败');
    const { main } = handler;
    const result = await main({
      httpMethod: request.method,
      path: parsed.pathname,
      rawPath: parsed.pathname,
      queryStringParameters: Object.fromEntries(parsed.searchParams.entries()),
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    response.statusCode = result.statusCode || result.status || 200;
    for (const [name, value] of Object.entries(result.headers || {})) response.setHeader(name, value);
    response.end(result.body || '');
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ message: error instanceof Error ? error.message : '服务器启动失败' }));
  }
});

server.listen(port, '0.0.0.0', () => console.log(`worklog-api listening on ${port}`));
