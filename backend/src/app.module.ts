import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivityModule } from './activity/activity.module';
import { AutomationsModule } from './automations/automations.module';
import { AuditInterceptor } from './auth/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { RequestContextInterceptor } from './auth/request-context.interceptor';
import { BuildingsModule } from './buildings/buildings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { SaasModule } from './saas/saas.module';
import { TenantsModule } from './tenants/tenants.module';
import { UnitsModule } from './units/units.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    EmailModule,
    HealthModule,
    AuthModule,
    ActivityModule,
    DashboardModule,
    BuildingsModule,
    UnitsModule,
    TenantsModule,
    InvoicesModule,
    PaymentsModule,
    SaasModule,
    AutomationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
