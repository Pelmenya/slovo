import {
    registerDecorator,
    type ValidationArguments,
    type ValidationOptions,
    ValidatorConstraint,
    type ValidatorConstraintInterface,
} from 'class-validator';

// =============================================================================
// `@MaxDecodedBytes(maxBytes)` — class-validator decorator для base64-string
// полей. Проверяет реальный декодированный размер (Buffer.from(b64).length),
// не string-length.
//
// Зачем: `@MaxLength` ограничивает только длину строки. Для image upload
// 5MB декодированный = ~7MB base64 string. Если использовать `@MaxLength`
// напрямую — overhead в 33% даёт нечёткие границы. `@MaxDecodedBytes(5MB)`
// проверяет ровно decoded bytes.
//
// Используется в `apps/api/.../search-image.request.dto.ts` для VISION_MAX_IMAGE_SIZE_BYTES.
// =============================================================================

@ValidatorConstraint({ name: 'maxDecodedBytes', async: false })
class MaxDecodedBytesConstraint implements ValidatorConstraintInterface {
    validate(value: unknown, args: ValidationArguments): boolean {
        if (typeof value !== 'string') {
            return false;
        }
        const constraints = args.constraints as [number];
        const maxBytes = constraints[0];
        try {
            // Buffer.from с base64 не throws на невалидной строке —
            // молча игнорирует невалидные символы. IsBase64() validator
            // вызывается раньше и фильтрует мусор; здесь корректное value.
            return Buffer.from(value, 'base64').length <= maxBytes;
        } catch {
            return false;
        }
    }

    defaultMessage(args: ValidationArguments): string {
        const constraints = args.constraints as [number];
        const maxBytes = constraints[0];
        const maxMb = (maxBytes / (1024 * 1024)).toFixed(1);
        return `Decoded byte length must be ≤ ${String(maxBytes)} bytes (${maxMb}MB)`;
    }
}

export function MaxDecodedBytes(
    maxBytes: number,
    options?: ValidationOptions,
): PropertyDecorator {
    return (object: object, propertyName: string | symbol) => {
        registerDecorator({
            name: 'maxDecodedBytes',
            target: object.constructor,
            propertyName: propertyName as string,
            options,
            constraints: [maxBytes],
            validator: MaxDecodedBytesConstraint,
        });
    };
}
