
import {TurnRole,Intent} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsInt,IsNotEmpty,IsOptional,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateCallTurnDto {
  @ApiProperty({
  description: `Порядковый номер реплики в диалоге, с 0`,
  type: `integer`,
  format: `int32`,
})
@IsNotEmpty()
@IsInt()
position: number;
@ApiProperty({
  enum: TurnRole,
})
@IsNotEmpty()
@IsIn(["robot","patient"])
role: TurnRole;
@IsNotEmpty()
@IsString()
text: string;
@ApiProperty({
  enum: Intent,
})
@IsOptional()
@IsIn(["confirm","cancel","reschedule","unclear"])
intent?: Intent;
@ApiProperty({
  description: `Путь к файлу записи ответа пациента (только реплики patient)`,
})
@IsOptional()
@IsString()
recordingPath?: string;
}
