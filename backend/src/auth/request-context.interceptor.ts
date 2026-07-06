import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestContext, AuthPayload } from './request-context';

type RequestWithUser = {
  user?: AuthPayload;
};

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestContext) {}

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = executionContext.switchToHttp().getRequest<RequestWithUser>();
    return this.context.run({ user: request.user }, () => next.handle());
  }
}
