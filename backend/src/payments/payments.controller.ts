import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CreatePaymentDto, UpdatePaymentDto } from './dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  findAll() {
    return this.payments.findAll();
  }

  @Get('trash')
  findTrashed() {
    return this.payments.findTrashed();
  }

  @Get('trash/:id')
  findTrashedOne(@Param('id', ParseIntPipe) id: number) {
    return this.payments.findTrashedOne(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.payments.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePaymentDto) {
    return this.payments.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.payments.remove(id, body);
  }

  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.payments.restore(id, body);
  }
}
