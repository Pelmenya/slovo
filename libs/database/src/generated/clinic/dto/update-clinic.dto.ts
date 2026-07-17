
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsOptional,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateClinicDto {
  @IsOptional()
@IsString()
name?: string;
@ApiProperty({
  description: `Шаблоны фраз тенанта: greeting, reAsk, byeConfirmed... (ключ → текст с плейсхолдерами)`,
})
@IsOptional()
phraseTemplates?: Prisma.InputJsonValue;
@ApiProperty({
  description: `Неймспейс env-переменных тенанта (SIP_USER_<ns> и т.д.) — секреты живут в env, не в БД`,
})
@IsOptional()
@IsString()
envNamespace?: string;
}
