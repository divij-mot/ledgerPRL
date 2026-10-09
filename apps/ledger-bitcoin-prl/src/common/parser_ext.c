/* Modified for Pearl (PRL). Upstream provenance: UPSTREAM.json. */
#include <stdio.h>

#include "parser_ext.h"

/* SDK headers */
#include "read.h"
#include "varint.h"

size_t dbuffer_get_length(buffer_t *buffers[2]) {
    return (buffers[0]->size - buffers[0]->offset) + (buffers[1]->size - buffers[1]->offset);
}

bool dbuffer_can_read(buffer_t *buffers[2], size_t n) {
    return dbuffer_get_length(buffers) >= n;
}

bool dbuffer_read_bytes(buffer_t *buffers[2], uint8_t *out, size_t n) {
    size_t length0 = buffers[0]->size - buffers[0]->offset;
    size_t length1 = buffers[1]->size - buffers[1]->offset;
    if (n > length0 + length1) {
        return false;
    }

    size_t n0 = (length0 >= n) ? n : length0;  // bytes to read from first buffer
    size_t n1 = n - n0;                        // bytes to read from second buffer

    if (n0 > 0) {
        buffer_read_bytes(buffers[0], out, n0);
    }
    if (n1 > 0) {
        buffer_read_bytes(buffers[1], out + n0, n1);
    }
    return true;
}

bool dbuffer_read_u8(buffer_t *buffers[2], uint8_t *out) {
    return dbuffer_read_bytes(buffers, out, 1);
}

bool dbuffer_read_u16(buffer_t *buffers[2], uint16_t *out, endianness_t endianness) {
    if (!dbuffer_can_read(buffers, 2)) {
        return false;
    }

    uint8_t tmp[2];
    dbuffer_read_bytes(buffers, tmp, 2);
    if (endianness == BE)
        *out = read_u16_be(tmp, 0);
    else
        *out = read_u16_le(tmp, 0);
    return true;
}

bool dbuffer_read_u32(buffer_t *buffers[2], uint32_t *out, endianness_t endianness) {
    if (!dbuffer_can_read(buffers, 4)) {
        return false;
    }

    uint8_t tmp[4];
    dbuffer_read_bytes(buffers, tmp, 4);
    if (endianness == BE)
        *out = read_u32_be(tmp, 0);
    else
        *out = read_u32_le(tmp, 0);
    return true;
}

int dbuffer_read_varint(buffer_t *buffers[2], uint64_t *out) {
    if (!dbuffer_can_read(buffers, 1)) {
        return 0;
    }

    // peek the first byte without changing the offsets
    uint8_t first_byte = buffer_can_read(buffers[0], 1) ? buffers[0]->ptr[buffers[0]->offset]
                                                        : buffers[1]->ptr[buffers[1]->offset];
    uint8_t len;  // length excluding the prefix
    switch (first_byte) {
        case 0xfd:
            len = 2;
            break;
        case 0xfe:
            len = 4;
            break;
        case 0xff:
            len = 8;
            break;
        default:
            len = 0;
            break;
    }

    if (!dbuffer_can_read(buffers, 1 + len)) {
        return 0;
    }

    buffer_t cursor0 = *buffers[0], cursor1 = *buffers[1];
    buffer_t *cursors[2] = {&cursor0, &cursor1};
    if (!dbuffer_read_u8(cursors, &first_byte)) {
        return 0;
    }

    uint64_t decoded = first_byte;
    if (len > 0) {
        uint8_t data[8] = {0};
        if (!dbuffer_read_bytes(cursors, data, len)) {
            return 0;
        }

        // Zero extension allows one little-endian read for all payload widths.
        decoded = read_u64_le(data, 0);
    }

    if (1 + len != varint_size(decoded)) {
        return -1;
    }

    buffers[0]->offset = cursor0.offset;
    buffers[1]->offset = cursor1.offset;
    *out = decoded;
    return 1;
}

bool parser_consolidate_buffers(buffer_t *buffers[2], size_t max_size) {
    size_t length0 = buffers[0]->size - buffers[0]->offset;
    size_t length1 = buffers[1]->size - buffers[1]->offset;
    if (length0 + length1 > max_size) {
        return false;
    }

    memmove(buffers[0]->ptr, buffers[0]->ptr + buffers[0]->offset, length0);
    if (length1 > 0) {
        memmove(buffers[0]->ptr + length0, buffers[1]->ptr + buffers[1]->offset, length1);
    }
    buffers[0]->offset = 0;
    buffers[0]->size = length0 + length1;
    return true;
}

int parser_run(const parsing_step_t *parsing_steps,
               size_t n_steps,
               parser_context_t *parser_context,
               buffer_t *buffers[2],
               void *(*pic_fn)(void *) ) {
    while (parser_context->cur_step < n_steps) {
        parsing_step_t step_fn =
            pic_fn != NULL ? (parsing_step_t) pic_fn(parsing_steps[parser_context->cur_step])
                           : parsing_steps[parser_context->cur_step];

        int step_result = step_fn(parser_context->state, buffers);

        if (step_result <= 0) {
            // Either error, or parsing incomplete and more data is needed
            return step_result;
        } else {
            // continue with the next step
            ++parser_context->cur_step;
        }
    }
    return 1;
}
