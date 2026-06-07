import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Scopes } from '../../auth/scopes.decorator';
import { ScopesGuard } from '../../auth/scopes.guard';

import { GenerateQrCodeUseCase } from '../application/generate-qr-code.use-case';
import { ScanQrCodeUseCase } from '../application/scan-qr-code.use-case';
import { ManualCheckInUseCase } from '../application/manual-check-in.use-case';
import { ListEventCheckInsUseCase } from '../application/list-event-check-ins.use-case';
import { GetUserCheckInUseCase } from '../application/get-user-check-in.use-case';
import { GetStatsUseCase } from '../application/get-stats.use-case';

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
  constructor(
    private readonly generateQrCodeUseCase: GenerateQrCodeUseCase,
    private readonly scanQrCodeUseCase: ScanQrCodeUseCase,
    private readonly manualCheckInUseCase: ManualCheckInUseCase,
    private readonly listEventCheckInsUseCase: ListEventCheckInsUseCase,
    private readonly getUserCheckInUseCase: GetUserCheckInUseCase,
    private readonly getStatsUseCase: GetStatsUseCase,
  ) {}

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

    return this.generateQrCodeUseCase.execute(eventId, userId);
  }

  @Post('check-ins/scan')
  @Scopes('staff', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Registra check-in via QR code',
    description: 'Valida o JWT do QR code, confirma inscrição do participante no Registration Service e persiste o check-in. Retorna 409 com o registro existente em caso de scan duplicado. Requer escopo `staff`, `organizer` ou `admin`.',
  })
  @ApiResponse({ status: 201, description: 'Check-in registrado', type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido — campos obrigatórios ausentes ou tipo incorreto' })
  @ApiResponse({ status: 401, description: 'Token de acesso ou QR code inválido/expirado' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 409, description: 'Participante já fez check-in — retorna o registro existente', type: CheckInDto })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async scan(@Body() body: ScanQrCodeDto, @Req() request: any): Promise<CheckInDto> {
    return this.scanQrCodeUseCase.execute(
      body.token,
      body.eventId,
      request.user?.sub ?? body.scannedBy,
    );
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
    return this.listEventCheckInsUseCase.execute(eventId, Number(page ?? 1), Number(limit ?? 20));
  }

  // Static route BEFORE dynamic :userId to avoid routing conflict
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
    return this.getStatsUseCase.execute(eventId);
  }

  @Post('events/:eventId/check-ins/manual')
  @Scopes('staff', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Check-in manual (fallback)',
    description: 'Registra check-in sem QR code. Retorna 409 com o registro existente em caso de duplicata. Requer escopo `staff`, `organizer` ou `admin`.',
  })
  @ApiParam({ name: 'eventId', description: 'ID do evento', example: 'evt-123' })
  @ApiResponse({ status: 201, description: 'Check-in manual registrado', type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido — userId ou performedBy ausente' })
  @ApiResponse({ status: 401, description: 'Token inválido ou ausente' })
  @ApiResponse({ status: 403, description: 'Escopo insuficiente' })
  @ApiResponse({ status: 409, description: 'Participante já fez check-in — retorna o registro existente', type: CheckInDto })
  @ApiResponse({ status: 422, description: 'Participante não inscrito ou não confirmado no evento' })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async manualCheckIn(
    @Param('eventId') eventId: string,
    @Body() body: ManualCheckInDto,
    @Req() request: any,
  ): Promise<CheckInDto> {
    return this.manualCheckInUseCase.execute(
      eventId,
      body.userId,
      request.user?.sub ?? body.performedBy,
      body.reason,
    );
  }

  @Get('events/:eventId/check-ins/:userId')
  @Scopes('user', 'organizer', 'admin')
  @ApiOperation({
    summary: 'Consulta check-in de um participante',
    description: 'Retorna o check-in de um participante específico no evento. Usuário com escopo `user` só pode consultar o próprio check-in.',
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

    return this.getUserCheckInUseCase.execute(eventId, userId);
  }
}
