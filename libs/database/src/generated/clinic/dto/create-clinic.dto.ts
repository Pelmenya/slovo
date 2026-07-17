
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsNotEmpty,IsOptional,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateClinicDto {
  @IsNotEmpty()
@IsString()
name: string;
@ApiProperty({
  description: `Шаблоны фраз тенанта: greeting, reAsk, byeConfirmed... (ключ → текст с плейсхолдерами)`,
})
@IsOptional()
phraseTemplates?: Prisma.InputJsonValue;
@ApiProperty({
  description: `Неймспейс env-переменных тенанта (SIP_USER_<ns> и т.д.) — секреты живут в env, не в БД`,
})
@IsNotEmpty()
@IsString()
envNamespace: string;
}
