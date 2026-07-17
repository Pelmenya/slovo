
import {TurnRole,Intent} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsInt,IsOptional,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateCallTurnDto {
  @ApiProperty({
  description: `Порядковый номер реплики в диалоге, с 0`,
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
position?: number;
@ApiProperty({
  enum: TurnRole,
})
@IsOptional()
@IsIn(["robot","patient"])
role?: TurnRole;
@IsOptional()
@IsString()
text?: string;
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
