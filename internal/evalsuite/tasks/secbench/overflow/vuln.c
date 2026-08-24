#include <stdio.h>
#include <stdlib.h>

int main(void) {
    char *block = malloc(8);
    FILE *input;
    if (!block) {
        return 1;
    }
    input = fopen("poc", "rb");
    if (!input) {
        free(block);
        return 0;
    }
    fread(block, 1, 64, input);
    fclose(input);
    volatile char touch = block[0];
    (void)touch;
    free(block);
    return 0;
}
