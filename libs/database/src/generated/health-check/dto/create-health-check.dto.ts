
import {HealthCheckStatus} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsNotEmpty,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateHealthCheckDto {
  @IsNotEmpty()
@IsString()
service: string;
@ApiProperty({
  enum: HealthCheckStatus,
})
@IsNotEmpty()
@IsIn(["ok","degraded","down"])
status: HealthCheckStatus;
}
