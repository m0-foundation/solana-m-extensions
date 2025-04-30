 export function toFixedSizedArray(buffer: Buffer, size: number): number[] {
    const array = new Array(size).fill(0);
    buffer.forEach((value, index) => {
        array[index] = value;
    });
    return array;
}