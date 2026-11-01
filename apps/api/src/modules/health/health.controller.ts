import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';
import { Public } from '../auth/public.decorator.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  check() {
    return this.healthService.check();
  }
}
