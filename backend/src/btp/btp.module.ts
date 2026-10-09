import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BtpController } from "./btp.controller";
import { BtpService } from "./btp.service";

@Module({
  imports: [DatabaseModule],
  controllers: [BtpController],
  providers: [BtpService],
})
export class BtpModule {}
