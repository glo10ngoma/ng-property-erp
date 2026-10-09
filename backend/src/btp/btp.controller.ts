import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { RequireOrganizationModule } from "../sales/sales-module.decorator";
import {
  BtpListQueryDto,
  CreateBtpExpenseDto,
  CreateBtpPhaseDto,
  CreateBtpProjectDto,
  UpdateBtpExpenseDto,
  UpdateBtpPhaseDto,
  UpdateBtpProjectDto,
} from "./btp.dto";
import { BtpService } from "./btp.service";

@Controller("btp")
@RequireOrganizationModule("BTP")
export class BtpController {
  constructor(private readonly btp: BtpService) {}
  @Get("dashboard") dashboard() {
    return this.btp.dashboard();
  }
  @Get("projects") listProjects(@Query() query: BtpListQueryDto) {
    return this.btp.listProjects(query);
  }
  @Get("projects/:id") getProject(@Param("id", ParseIntPipe) id: number) {
    return this.btp.getProject(id);
  }
  @Post("projects") createProject(@Body() dto: CreateBtpProjectDto) {
    return this.btp.createProject(dto);
  }
  @Patch("projects/:id") updateProject(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateBtpProjectDto,
  ) {
    return this.btp.updateProject(id, dto);
  }
  @Post("phases") createPhase(@Body() dto: CreateBtpPhaseDto) {
    return this.btp.createPhase(dto);
  }
  @Patch("phases/:id") updatePhase(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateBtpPhaseDto,
  ) {
    return this.btp.updatePhase(id, dto);
  }
  @Get("expenses") listExpenses(@Query() query: BtpListQueryDto) {
    return this.btp.listExpenses(query);
  }
  @Post("expenses") createExpense(@Body() dto: CreateBtpExpenseDto) {
    return this.btp.createExpense(dto);
  }
  @Patch("expenses/:id") updateExpense(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateBtpExpenseDto,
  ) {
    return this.btp.updateExpense(id, dto);
  }
}
