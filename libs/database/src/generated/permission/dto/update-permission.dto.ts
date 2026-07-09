
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdatePermissionDto {
  @IsOptional()
@IsString()
action?: string;
@IsOptional()
@IsString()
toolName?: string;
@IsOptional()
args?: Prisma.InputJsonValue;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
respondedAt?: Date;
@IsOptional()
@IsString()
respondedBy?: string;
@IsOptional()
@IsString()
reason?: string;
}
