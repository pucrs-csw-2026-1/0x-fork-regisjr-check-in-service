import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  @ApiOperation({ summary: 'Health check' })
  check(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor((Date.now() - this.startedAt) / 1000) };
  }
}
