import { IsString, IsNotEmpty, Matches, Length } from 'class-validator';

export class AddCuitDto {
  @IsString()
  @IsNotEmpty()
  @Length(11, 11, { message: 'El CUIT debe tener exactamente 11 caracteres' })
  @Matches(/^\d+$/, { message: 'El CUIT debe contener solo números' })
  cuit: string;
}
