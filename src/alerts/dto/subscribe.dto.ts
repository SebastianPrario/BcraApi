import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class SubscribeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  cuit: string;
}
