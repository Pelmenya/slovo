
import {CallOutcome} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsInt,IsNotEmpty,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateCallDto {
  @IsNotEmpty()
@IsString()
phone: string;
@IsNotEmpty()
@IsString()
patientName: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsNotEmpty()
@IsRFC3339()
appointmentAt: Date;
@ApiProperty({
  enum: CallOutcome,
})
@IsOptional()
@IsIn(["confirmed","canceled","reschedule_requested","unclear","no_answer","failed"])
outcome?: CallOutcome;
@IsOptional()
@IsString()
channelId?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
dialedAt?: Date;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
answeredAt?: Date;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
endedAt?: Date;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
durationSeconds?: number;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
costKopecks?: number;
}
