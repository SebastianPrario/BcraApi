import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SecurityTokenGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-alert-token'];
   
    if (!token || token !== this.configService.get<string>('FRONTEND_TOKEN')) {
      throw new UnauthorizedException('Invalid or missing security token');
    }

    return true;
  }
}
