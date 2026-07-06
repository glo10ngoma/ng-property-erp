import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  findAll() {
    return this.invoices.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Post(':id/validate')
  validate(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.validate(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() body: { reason?: string }) {
    return this.invoices.cancel(id, body.reason ?? 'Annulation');
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.invoices.remove(id);
  }
}
