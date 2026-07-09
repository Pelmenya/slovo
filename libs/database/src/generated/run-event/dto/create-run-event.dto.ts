
import {Prisma,RunEventType} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsInt,IsNotEmpty} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateRunEventDto {
  @ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsNotEmpty()
@IsInt()
seq: number;
@ApiProperty({
  enum: RunEventType,
})
@IsNotEmpty()
@IsIn(["plan","tool_call","permission_request","permission_response","tool_result","evidence","model_call","error","quarantine","done","abort"])
type: RunEventType;
@IsNotEmpty()
payload: Prisma.InputJsonValue;
}
