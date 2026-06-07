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

// Auth Service role hierarchy (cumulative):
//   admin   ⊇ manager ⊇ participant
// A token for role X always includes all scopes of roles below it.

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
  @Roles('participant')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: 'Gera QR code para check-in',
    description: 'Emite JWT de curta duração (padrão 5 min). Role `participant` pode gerar apenas o próprio QR. `admin` pode gerar para qualquer usuário.',
  })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'ID do participante (sub do JWT)', example: 'uuid' })
  @ApiResponse({ status: 200, type: GenerateQrCodeResponseDto })
  @ApiResponse({ status: 401, description: 'Token ausente, expirado ou inválido' })
  @ApiResponse({ status: 403, description: 'Role insuficiente ou usuário tentando gerar QR de terceiro' })
  @ApiResponse({ status: 503, description: 'Registration Service indisponível' })
  async generateQrCode(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<GenerateQrCodeResponseDto> {
    const caller: string = request.user?.userId;
    if (caller !== userId && !request.user?.scopes?.includes('admin')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.generateQrCodeUseCase.execute(eventId, userId);
  }

  @Post('check-ins/scan')
  @Roles('manager')
  @ApiOperation({
    summary: 'Registra check-in via QR code',
    description: 'Role `manager` ou `admin`. Retorna 409 com o registro existente em caso de scan duplicado.',
  })
  @ApiResponse({ status: 201, type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido' })
  @ApiResponse({ status: 401, description: 'Token inválido/expirado' })
  @ApiResponse({ status: 403, description: 'Role insuficiente (requer manager)' })
  @ApiResponse({ status: 409, description: 'Participante já fez check-in', type: CheckInDto })
  @ApiResponse({ status: 503, description: 'Registration Service ou DynamoDB indisponível' })
  async scan(@Body() body: ScanQrCodeDto, @Req() request: any): Promise<CheckInDto> {
    return this.scanQrCodeUseCase.execute(
      body.token,
      body.eventId,
      request.user?.userId ?? body.scannedBy,
    );
  }

  @Get('events/:eventId/check-ins')
  @Roles('manager')
  @ApiOperation({ summary: 'Lista check-ins do evento', description: 'Role `manager` ou `admin`.' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, type: CheckInListResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente (requer manager)' })
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
  @Roles('manager')
  @ApiOperation({ summary: 'Estatísticas de presença do evento', description: 'Role `manager` ou `admin`.' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiResponse({ status: 200, type: CheckInStatsResponseDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente (requer manager)' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getStats(@Param('eventId') eventId: string): Promise<CheckInStatsResponseDto> {
    return this.getStatsUseCase.execute(eventId);
  }

  @Post('events/:eventId/check-ins/manual')
  @Roles('manager')
  @ApiOperation({ summary: 'Check-in manual (fallback sem QR)', description: 'Role `manager` ou `admin`. Retorna 409 em caso de duplicata.' })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiResponse({ status: 201, type: CheckInDto })
  @ApiResponse({ status: 400, description: 'Body inválido' })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Role insuficiente (requer manager)' })
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
      request.user?.userId ?? body.performedBy,
      body.reason,
    );
  }

  @Get('events/:eventId/check-ins/:userId')
  @Roles('participant')
  @ApiOperation({
    summary: 'Consulta check-in de um participante',
    description: 'Role `participant` só pode consultar o próprio. `manager`/`admin` podem consultar qualquer um.',
  })
  @ApiParam({ name: 'eventId', example: 'evt-123' })
  @ApiParam({ name: 'userId', description: 'ID do participante (sub do JWT)', example: 'uuid' })
  @ApiResponse({ status: 200, type: CheckInDto })
  @ApiResponse({ status: 401, description: 'Token inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Participante tentando ver check-in de terceiro' })
  @ApiResponse({ status: 404, description: 'Participante ainda não fez check-in' })
  @ApiResponse({ status: 503, description: 'DynamoDB indisponível' })
  async getUserCheckIn(
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
    @Req() request: any,
  ): Promise<CheckInDto> {
    const caller: string = request.user?.userId;
    if (
      caller !== userId &&
      !request.user?.scopes?.includes('admin') &&
      !request.user?.scopes?.includes('manager')
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return this.getUserCheckInUseCase.execute(eventId, userId);
  }
}
