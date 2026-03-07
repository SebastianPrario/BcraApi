import { Controller, Post, Get, Body, Param, UseGuards, Delete } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { SecurityTokenGuard } from '../auth/security-token.guard';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) { }

  @UseGuards(SecurityTokenGuard)
  @Post('subscribe')
  async subscribe(@Body() subscribeDto: SubscribeDto) {
    return this.alertsService.subscribe(subscribeDto);
  }

  @Get('unsubscribe/:id')
  async unsubscribe(@Param('id') id: string) {
    return this.alertsService.unsubscribe(id);
  }
}
