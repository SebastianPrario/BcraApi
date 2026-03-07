import { IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class SubscribeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  cuit: string;
}
