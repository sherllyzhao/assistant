export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 使用 Service Binding 进行内部调用（完全绕过公网，不受 GFW 影响）
  if (env.WORKER) {
    const workerRequest = new Request(`https://sherlly-server${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return await env.WORKER.fetch(workerRequest);
  }

  // 降级方案：直接 fetch Worker URL（如果 Service Binding 未配置）
  const workerUrl = 'https://sherlly-server.1253108690.workers.dev' + url.pathname + url.search;
  const workerRequest = new Request(workerUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  const response = await fetch(workerRequest);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
