import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const databaseUrl = config.get<string>('DATABASE_URL');
  const jwtSecret = config.get<string>('JWT_SECRET');

  if (!databaseUrl) {
    throw new Error('Missing required environment variable DATABASE_URL');
  }
  if (!jwtSecret) {
    throw new Error('Missing required environment variable JWT_SECRET');
  }

  const configuredOrigins = (config.get<string>('CORS_ORIGIN') ?? config.get<string>('FRONTEND_URL') ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const loopbackAliases = configuredOrigins.flatMap((origin) => {
    if (origin.includes('127.0.0.1')) return [origin, origin.replace('127.0.0.1', 'localhost')];
    if (origin.includes('localhost')) return [origin, origin.replace('localhost', '127.0.0.1')];
    return [origin];
  });

  const origins = Array.from(new Set(loopbackAliases));

  app.enableCors({ origin: origins });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(config.get<number>('PORT') ?? 3000, '0.0.0.0');
}

bootstrap();
