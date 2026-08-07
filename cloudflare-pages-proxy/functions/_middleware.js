export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // 构造完整的 Worker URL
  const workerUrl = 'https://sherlly-server.1253108690.workers.dev' + url.pathname + url.search;
  
  // 转发请求到 Worker
  const workerRequest = new Request(workerUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  
  const response = await fetch(workerRequest);
  
  // 确保 CORS 头正确传递
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
