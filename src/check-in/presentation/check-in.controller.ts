import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Scopes } from '../../auth/scopes.decorator';
import { ScopesGuard } from '../../auth/scopes.guard';
import { CheckInService } from '../check-in.service';
import {
  CheckInDto,
  CheckInListResponseDto,
  CheckInStatsResponseDto,
  GenerateQrCodeResponseDto,
  ManualCheckInDto,
  ScanQrCodeDto,
} from './dto/check-in.dto';

@ApiTags('Check-ins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ScopesGuard)
@Controller()
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Get('events/:eventId/guests/:userId/qr-code')
  @Scopes('user', 'admin')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'Gera QR code para check-in',
    description: 'Emite um JWT de curta duração (padrão 5 min) que o participante apresenta na entrada. Limitado a 10 req/min por participante. Requer escopo `user` (próprio QR) ou `admin`.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'ID do participante', example: 'user-xyz' })
  @ApiResponse({ status: 200, description: 'Token QR gerado com sucesso', type: GenerateQrCodeResponseDto })
  @ApiResponse({ status: 401, description: 'Token de acesso ausente, expirado ou inválido' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente ou usuário tentando gerar QR de terceiro' })
  @ApiResponse({ status: 503, description: 'Registration Service indisponível' })
  async generateQrCode(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<GenerateQrCodeResponseDto> {
    if (request.user?.sub !== userId && !request.user?.scopes?.includes('admin')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return this.checkInService.generateQrCode(eventId, userId);
  }

  @Post('check-ins/scan')
  @Scopes('staff', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Registra check-in via QR code',
    description: 'Valida o JWT do QR code, confirma inscrição do participante no Registration Service e persiste o check-in. Idempotente: retorna o check-in existente em caso de scan duplicado. Requer escopo `staff`, `organizer` ou `admin`.',
  })
  @ApiResponse({ status: 201, description: 'Check-in registrado (ou já existente)', type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido — campos obrigatórios ausentes ou tipo incorreto' })
  @ApiResponse({ status: 401, description: 'Token de acesso ou QR code inválido/expirado' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async scan(@Body() body: ScanQrCodeDto, @Req() request: any): Promise<CheckInDto> {
    return this.checkInService.scan({
      token: body.token,
      eventId: body.eventId,
      scannedBy: request.user?.sub ?? body.scannedBy,
    });
  }

  @Get('events/:eventId/check-ins')
  @Scopes('organizer', 'admin')
  @ApiOperation({
    summary: 'Lista check-ins do evento',
    description: 'Retorna lista paginada de todos os check-ins de um evento. Requer escopo `organizer` ou `admin`.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiQuery({ name: 'page', required: false, description: 'Número da página (padrão: 1)', example: 1 })
  @ApiQuery({ name: 'limit', required: false, description: 'Itens por página (padrão: 20)', example: 20 })
  @ApiResponse({ status: 200, description: 'Lista paginada de check-ins', type: CheckInListResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async listEventCheckIns(
    @Param('eventId') eventId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<CheckInListResponseDto> {
    return this.checkInService.listEventCheckIns(eventId, Number(page ?? 1), Number(limit ?? 20));
  }

  // Static route declared BEFORE the dynamic :userId route to avoid routing conflict
  @Get('events/:eventId/check-ins/stats')
  @Scopes('organizer', 'admin')
  @ApiOperation({
    summary: 'Estatísticas de presença do evento',
    description: 'Retorna total de check-ins, breakdown por método (QR vs. manual) e total de tokens QR emitidos. Requer escopo `organizer` ou `admin`.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiResponse({ status: 200, description: 'Estatísticas de presença', type: CheckInStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getStats(@Param('eventId') eventId: string): Promise<CheckInStatsResponseDto> {
    return this.checkInService.getStats(eventId);
  }

  @Post('events/:eventId/check-ins/manual')
  @Scopes('staff', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Check-in manual (fallback)',
    description: 'Registra check-in sem QR code — usado quando o leitor está indisponível ou o participante não consegue exibir o QR. Requer escopo `staff`, `organizer` ou `admin`.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiResponse({ status: 201, description: 'Check-in manual registrado', type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido — userId ou performedBy ausente' })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 422, description: 'Participante não inscrito ou não confirmado no evento' })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async manualCheckIn(
    @Param('eventId') eventId: string,
    @Body() body: ManualCheckInDto,
    @Req() request: any,
  ): Promise<CheckInDto> {
    return this.checkInService.manualCheckIn(eventId, {
      userId: body.userId,
      performedBy: request.user?.sub ?? body.performedBy,
      reason: body.reason,
    });
  }

  @Get('events/:eventId/check-ins/:userId')
  @Scopes('user', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Consulta check-in de um participante',
    description: 'Retorna o check-in de um participante específico no evento. Usuário com escopo `user` só pode consultar o próprio check-in. `organizer` e `admin` podem consultar qualquer um.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'ID do participante', example: 'user-xyz' })
  @ApiResponse({ status: 200, description: 'Check-in encontrado', type: CheckInDto })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente' })
  @ApiResponse({ status: 403, description: 'Usuário tentando ver check-in de terceiro sem permissão' })
  @ApiResponse({ status: 404, description: 'Participante ainda não fez check-in neste evento' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getUserCheckIn(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<CheckInDto> {
    if (
      request.user?.sub !== userId &&
      !request.user?.scopes?.includes('admin') &&
      !request.user?.scopes?.includes('organizer')
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return this.checkInService.getUserCheckIn(eventId, userId);
  }
}
