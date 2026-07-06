import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ActivityModule } from './activity/activity.module';
import { AuditInterceptor } from './auth/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { RequestContextInterceptor } from './auth/request-context.interceptor';
import { BuildingsModule } from './buildings/buildings.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InvoicesModule } from './invoices/invoices.module';
import { PaymentsModule } from './payments/payments.module';
import { SaasModule } from './saas/saas.module';
import { TenantsModule } from './tenants/tenants.module';
import { UnitsModule } from './units/units.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
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
  ],
  providers: [
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
