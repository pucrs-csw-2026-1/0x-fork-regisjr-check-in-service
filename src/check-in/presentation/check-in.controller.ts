import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';

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
@UseGuards(JwtAuthGuard, RolesGuard)
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
  @Roles('user', 'admin')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Gera QR code para check-in', description: 'Requer role user (próprio QR) ou admin.' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'Keycloak user ID', example: 'uuid-keycloak' })
  @ApiResponse({ status: 200, type: GenerateQrCodeResponseDto })
  @ApiResponse({ status: 401, description: 'Token ausente, expirado ou inválido' })
  @ApiResponse({ status: 403, description: 'Role insuficiente ou usuário tentando gerar QR de terceiro' })
  @ApiResponse({ status: 503, description: 'Registration Service indisponível' })
  async generateQrCode(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<GenerateQrCodeResponseDto> {
    const caller: string = request.user?.keycloakUserId;
    if (caller !== userId && !request.user?.roles?.includes('admin')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.generateQrCodeUseCase.execute(eventId, userId);
  }

  @Post('check-ins/scan')
  @Roles('staff', 'organizer', 'admin')
  @ApiOperation({ summary: 'Registra check-in via QR code', description: 'Retorna 409 com registro existente em caso de duplicata.' })
  @ApiResponse({ status: 201, type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido' })
  @ApiResponse({ status: 401, description: 'Token inválido/expirado' })
  @ApiResponse({ status: 403, description: 'Role insuficiente' })
  @ApiResponse({ status: 409, description: 'Participante já fez check-in', type: CheckInDto })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async scan(@Body() body: ScanQrCodeDto, @Req() request: any): Promise<CheckInDto> {
    return this.scanQrCodeUseCase.execute(
      body.token,
      body.eventId,
      request.user?.keycloakUserId ?? body.scannedBy,
    );
  }

  @Get('events/:eventId/check-ins')
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Lista check-ins do evento' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, type: CheckInListResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente' })
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
  @Roles('organizer', 'admin')
  @ApiOperation({ summary: 'Estatísticas de presença do evento' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiResponse({ status: 200, type: CheckInStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getStats(@Param('eventId') eventId: string): Promise<CheckInStatsResponseDto> {
    return this.getStatsUseCase.execute(eventId);
  }

  @Post('events/:eventId/check-ins/manual')
  @Roles('staff', 'organizer', 'admin')
  @ApiOperation({ summary: 'Check-in manual (fallback sem QR)' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiResponse({ status: 201, type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido' })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente' })
  @ApiResponse({ status: 409, description: 'Participante já fez check-in', type: CheckInDto })
  @ApiResponse({ status: 422, description: 'Participante não inscrito ou não confirmado' })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async manualCheckIn(
    @Param('eventId') eventId: string,
    @Body() body: ManualCheckInDto,
    @Req() request: any,
  ): Promise<CheckInDto> {
    return this.manualCheckInUseCase.execute(
      eventId,
      body.userId,
      request.user?.keycloakUserId ?? body.performedBy,
      body.reason,
    );
  }

  @Get('events/:eventId/check-ins/:userId')
  @Roles('user', 'organizer', 'admin')
  @ApiOperation({ summary: 'Consulta check-in de um participante', description: 'Role user só pode consultar o próprio.' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'Keycloak user ID', example: 'uuid-keycloak' })
  @ApiResponse({ status: 200, type: CheckInDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Usuário tentando ver check-in de terceiro' })
  @ApiResponse({ status: 404, description: 'Participante ainda não fez check-in' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getUserCheckIn(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<CheckInDto> {
    const caller: string = request.user?.keycloakUserId;
    if (
      caller !== userId &&
      !request.user?.roles?.includes('admin') &&
      !request.user?.roles?.includes('organizer')
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.getUserCheckInUseCase.execute(eventId, userId);
  }
}
