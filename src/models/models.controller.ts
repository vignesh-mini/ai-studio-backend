import { Controller, Get } from '@nestjs/common';
import { ModelsService } from './models.service.js';

@Controller('models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  list() {
    return this.models.list();
  }
}
