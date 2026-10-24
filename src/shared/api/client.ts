export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function http<T>(path: string, options?: RequestInit): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  const response = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Bloom-Request': '1', ...options?.headers },
  });
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('bloom-unauthorized'));
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(
      body.message || 'Không thể xử lý yêu cầu. Vui lòng thử lại.',
      response.status,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
