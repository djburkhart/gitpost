export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, {
    credentials: "include",
    ...opts,
    headers,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText);
    (err as any).status = res.status;
    throw err;
  }
  return data as T;
}
