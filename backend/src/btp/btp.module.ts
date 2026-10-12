import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BtpController } from "./btp.controller";
import { BtpService } from "./btp.service";
import { BtpOperationsController } from "./btp-operations.controller";
import { BtpOperationsService } from "./btp-operations.service";

@Module({
  imports: [DatabaseModule],
  controllers: [BtpController, BtpOperationsController],
  providers: [BtpService, BtpOperationsService],
})
export class BtpModule {}
