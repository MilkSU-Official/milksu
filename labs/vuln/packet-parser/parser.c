#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int parse_packet(const uint8_t *data, size_t size) {
    if (size < 2) return -1;
    const size_t declared = ((size_t)data[0] << 8) | data[1];
    if (size < declared + 2) return -2;

    char name[16];
    memcpy(name, data + 2, declared); /* Intentionally vulnerable training line. */
    return name[0];
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: packet-parser <sample>\n");
        return 2;
    }
    FILE *input = fopen(argv[1], "rb");
    if (!input) return 3;
    uint8_t data[4096];
    const size_t size = fread(data, 1, sizeof(data), input);
    fclose(input);
    const int result = parse_packet(data, size);
    printf("parse result: %d\n", result);
    return result < 0 ? 4 : 0;
}
