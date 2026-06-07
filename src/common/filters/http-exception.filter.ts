import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const traceId = (request.headers['x-trace-id'] as string) ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let detail = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      // ADR-004/ADR-008: 409 Conflict with a CheckIn record passes through as-is
      // so the scanner can see who already checked in and when
      if (
        status === HttpStatus.CONFLICT &&
        typeof body === 'object' &&
        body !== null &&
        'checkInId' in body
      ) {
        response.status(status).json(body);
        return;
      }

      detail = typeof body === 'string' ? body : (body as { message?: string }).message ?? detail;
    } else {
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({ statusCode: status, detail, traceId });
  }
}
