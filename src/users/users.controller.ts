import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request, Patch } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddCuitDto } from './dto/add-cuit.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return this.usersService.findById(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cuits')
  addCuit(@Request() req, @Body() addCuitDto: AddCuitDto) {
    return this.usersService.addCuit(req.user.id, addCuitDto.cuit);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('cuits/:id')
  removeCuit(@Request() req, @Param('id') cuitId: string) {
    return this.usersService.removeCuit(req.user.id, cuitId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('email')
  updateEmail(@Request() req, @Body('email') newEmail: string) {
    return this.usersService.updateEmail(req.user.id, newEmail);
  }
}
