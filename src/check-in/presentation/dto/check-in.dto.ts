import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

import { CheckInMethod } from '../../domain/check-in.types';

export class GenerateQrCodeResponseDto {
  @ApiProperty({
    description: 'JWT assinado que representa o QR code do participante',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token!: string;

  @ApiProperty({
    description: 'Payload pronto para codificar em QR code (prefixo checkin://)',
    example: 'checkin://eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  qrPayload!: string;

  @ApiProperty({
    description: 'Data/hora de expiração do token (ISO 8601)',
    example: '2026-06-07T14:30:00.000Z',
  })
  expiresAt!: string;
}

export class ScanQrCodeDto {
  @ApiProperty({
    description: 'JWT do QR code lido pelo scanner (com ou sem prefixo checkin://)',
    example: 'checkin://eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  token!: string;

  @ApiProperty({
    description: 'ID do evento onde o scan está ocorrendo',
    example: 'evt-123',
  })
  @IsString()
  eventId!: string;

  @ApiProperty({
    description: 'ID do staff/organizer que realizou o scan',
    example: 'staff-001',
  })
  @IsString()
  scannedBy!: string;
}

export class ManualCheckInDto {
  @ApiProperty({
    description: 'ID do participante a ser registrado manualmente',
    example: 'user-xyz',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: 'ID do staff/organizer que realizou o check-in manual',
    example: 'staff-001',
  })
  @IsString()
  performedBy!: string;

  @ApiPropertyOptional({
    description: 'Motivo do check-in manual (ex.: QR reader quebrado)',
    example: 'Leitor de QR code indisponível no momento',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CheckInDto {
  @ApiProperty({
    description: 'Identificador único do check-in',
    example: 'ci-550e8400-e29b-41d4-a716-446655440000',
  })
  checkInId!: string;

  @ApiProperty({ description: 'ID do evento', example: 'evt-123' })
  eventId!: string;

  @ApiProperty({ description: 'ID do participante', example: 'user-xyz' })
  userId!: string;

  @ApiProperty({
    description: 'Data/hora em que o check-in foi realizado (ISO 8601)',
    example: '2026-06-07T14:00:00.000Z',
  })
  checkedInAt!: string;

  @ApiProperty({
    description: 'Método usado para realizar o check-in',
    enum: CheckInMethod,
    example: CheckInMethod.QrCode,
  })
  method!: CheckInMethod;

  @ApiProperty({
    description: 'ID de quem escaneou ou realizou o check-in manual (null em check-ins automáticos)',
    nullable: true,
    example: 'staff-001',
  })
  scannedBy!: string | null;

  @ApiProperty({
    description: 'Motivo do check-in manual; null para check-ins via QR code',
    nullable: true,
    example: null,
  })
  reason!: string | null;

  @ApiProperty({
    description: 'JTI (JWT ID) do token QR usado; null para check-ins manuais',
    nullable: true,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  tokenJti!: string | null;

  @ApiProperty({
    description: 'Data/hora de criação do registro (ISO 8601)',
    example: '2026-06-07T14:00:00.000Z',
  })
  createdAt!: string;
}

export class CheckInListResponseDto {
  @ApiProperty({ description: 'Lista de check-ins da página atual', type: [CheckInDto] })
  data!: CheckInDto[];

  @ApiProperty({ description: 'Total de check-ins no evento (todas as páginas)', example: 150 })
  total!: number;

  @ApiProperty({ description: 'Número da página atual (começa em 1)', example: 1 })
  page!: number;

  @ApiProperty({ description: 'Quantidade máxima de itens por página', example: 20 })
  limit!: number;
}

export class CheckInStatsResponseDto {
  @ApiProperty({ description: 'ID do evento', example: 'evt-123' })
  eventId!: string;

  @ApiProperty({ description: 'Total de participantes que fizeram check-in', example: 42 })
  totalCheckIns!: number;

  @ApiProperty({
    description: 'Contagem de check-ins agrupada por método',
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { qr_code: 38, manual: 4 },
  })
  byMethod!: Record<string, number>;

  @ApiProperty({
    description: 'Total de tokens QR emitidos para o evento (inclui não utilizados)',
    example: 50,
  })
  qrAudits!: number;
}
