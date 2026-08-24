#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
    FILE *input = fopen("poc", "rb");
    if (!input) return 0;
    char buf[8]; for(int i=0;i<64;i++) buf[i]=fgetc(input);
    fclose(input);
    return 0;
}
