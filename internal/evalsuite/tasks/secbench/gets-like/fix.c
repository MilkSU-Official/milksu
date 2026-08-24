#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; fscanf(input, "%7s", buf);
    fclose(input);
    return 0;
}
