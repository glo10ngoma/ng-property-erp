import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { RequestContext } from './request-context';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [RequestContext],
  exports: [RequestContext],
})
export class AuthModule {}
