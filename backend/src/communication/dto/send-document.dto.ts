import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { DocumentType } from '../shared/enums/document-type.enum';
import { DocumentDeliveryTrigger } from '../shared/enums/document-delivery-trigger.enum';

export class SendDocumentDto {
  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsInt()
  @Min(1)
  documentId!: number;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  cc?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsEnum(DocumentDeliveryTrigger)
  trigger?: DocumentDeliveryTrigger;
}
