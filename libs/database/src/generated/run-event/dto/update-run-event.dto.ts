
import {Prisma,RunEventType} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsInt,IsOptional} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateRunEventDto {
  @ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
seq?: number;
@ApiProperty({
  enum: RunEventType,
})
@IsOptional()
@IsIn(["plan","tool_call","permission_request","permission_response","tool_result","evidence","model_call","error","quarantine","done","abort"])
type?: RunEventType;
@IsOptional()
payload?: Prisma.InputJsonValue;
}
