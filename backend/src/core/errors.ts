export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'BUSINESS_RULE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function ensure(condition: unknown, message: string, status = 422): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function translateError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const e = error as { code?: string; message?: string };
  if (
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      '57P01',
      '57P02',
      '57P03',
      '53300',
    ].includes(e.code || '')
  )
    return new HttpError(
      503,
      'Không thể kết nối cơ sở dữ liệu. Vui lòng kiểm tra dịch vụ PostgreSQL hoặc liên hệ quản trị viên.',
      'DATABASE_UNAVAILABLE',
    );
  if (e.code === '23505')
    return new HttpError(409, 'Dữ liệu bị trùng hoặc đã được xử lý. Vui lòng tải lại.');
  if (e.code === '23503')
    return new HttpError(422, 'Dữ liệu có tham chiếu liên quan hoặc lựa chọn không hợp lệ.');
  if (['40001', '40P01', '55P03'].includes(e.code || ''))
    return new HttpError(409, 'Dữ liệu đang được xử lý đồng thời. Vui lòng thử lại.');
  if (e.code === 'P0001') return new HttpError(422, e.message || 'Không thỏa điều kiện nghiệp vụ.');
  if (['23514', '23502', '22001', '22P02', '22003', '22007', '22008'].includes(e.code || ''))
    return new HttpError(422, 'Giá trị, số lượng hoặc ngày không hợp lệ.');
  return new HttpError(500, 'Không thể xử lý yêu cầu. Vui lòng thử lại.', 'INTERNAL_ERROR');
}
